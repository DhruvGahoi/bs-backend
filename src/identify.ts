import { PoolClient } from "pg";

interface Contact {
    id: number;
    phone_number: string | null;
    email: string | null;
    linked_id: number | null;
    link_precedence: "primary" | "secondary";
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

interface IdentifyResult {
    contact: {
        primaryContactId: number;
        emails: string[];
        phoneNumbers: string[];
        secondaryContactId: number[];
    }
}

export async function identify(
    email: string | null,
    phoneNumber: string | null,
    client: PoolClient
) {
    // Check the matches, like if it matches the email or phone_number
    const {rows: matches} = await client.query<Contact>(
        `SELECT * FROM contact WHERE (email = $1 OR phone_number = $2) AND deleted_at is NULL`,
        [email, phoneNumber]
    )

    // if no matches are found, then create a new one
    if (matches.length === 0) {
        const { rows } = await client.query<Contact>(
            `INSERT INTO contact (email, phone_number, link_precedence)
            VALUES ($1, $2, 'primary') RETURNING *`,
            [email, phoneNumber]
        );
        const newContact = rows[0];
        return {
            contact: {
            primaryContactId: newContact.id,
            emails: newContact.email ? [newContact.email] : [],
            phoneNumbers: newContact.phone_number ? [newContact.phone_number] : [],
            secondaryContactId: []
            }
        };
    }

    // finding primaryid for match 
    const primaryIds = new Set<number>();
    for(const contact of matches){
        if(contact.link_precedence == "primary"){
            primaryIds.add(contact.id);
        } else if(contact.linked_id != null){
            primaryIds.add(contact.linked_id);
        }
    }

    const { rows: allContacts } = await client.query<Contact>(
        `SELECT * FROM contact 
        WHERE (id = ANY($1) OR linked_id = ANY($1)) AND deleted_at IS NULL
        ORDER BY created_at ASC`,
        [Array.from(primaryIds)]
    );

    const primaries = allContacts.filter(c => c.link_precedence === "primary");
    // oldest primary wins, losers get demoted, and all their children get re-adopted by the winner.
    if(primaries.length > 1){
        primaries.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
        const oldest = primaries[0];
        const toMerge = primaries.slice(1);

        await client.query(
            `UPDATE contact 
            SET link_precedence = 'secondary', 
            linked_id = $1, updated_at = NOW()
            WHERE id = ANY($2)`,
            [oldest.id, toMerge.map(c => c.id)]
        )

        await client.query(
            `UPDATE contact SET linked_id = $1, updated_at = NOW()
            WHERE linked_id = ANY($2)`,
            [oldest.id, toMerge.map(c => c.id)]
        )
    }

    const winner = allContacts.find(c => c.link_precedence === "primary")!;

    const { rows: cluster } = await client.query<Contact>(
        `SELECT * FROM contact 
        WHERE (id = $1 OR linked_id = $1) AND deleted_at IS NULL
        ORDER BY created_at ASC`,
        [winner.id]
    );

    // checks if the incoming email/phone is already in the cluster. if not, it creates a new secondary contact linked to the winner.
    const emailExists = cluster.some(c => c.email === email && email !== null);
    const phoneExists = cluster.some(c => c.phone_number === phoneNumber && phoneNumber !== null);
    if(!emailExists || !phoneExists){
        if(email !== null || phoneNumber !== null){
            await client.query(
                `INSERT INTO contact (email, phone_number, link_precedence, linked_id)
                VALUES ($1, $2, 'secondary', $3)`,
                [email, phoneNumber, winner.id]
            )
        }
    }

    const { rows: finalCluster } = await client.query<Contact>(
        `SELECT * FROM contact 
        WHERE (id = $1 OR linked_id = $1) AND deleted_at IS NULL
        ORDER BY created_at ASC`,
        [winner.id]
    )

    const secondaries = finalCluster.filter(c => c.link_precedence === "secondary");

    return {
        contact: {
            primaryContactId: winner.id,
            emails: [
                ...new Set(finalCluster.map(c => c.email).filter(Boolean) as string[]) 
            ],
            phoneNumbers: [
                ...new Set(finalCluster.map(c => c.phone_number).filter(Boolean) as string[])
            ],
            secondaryContactId: secondaries.map(c => c.id)
        }
    };
    
}