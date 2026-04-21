-- The second line of defence for the double-entry invariant.
-- Σ in = Σ out per currency is enforced in Go middleware (internal/ledger/invariant.go).
-- This trigger enforces the same rule at the database level, so even if the
-- application layer has a bug or something writes directly via SQL, corrupt
-- entries cannot be committed.
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED: it does not fire after each
-- row insert (which would reject every real transaction because intermediate
-- states are not balanced). Instead, it fires at COMMIT, after all entries
-- for the transaction have been written, and validates the whole group.

CREATE OR REPLACE FUNCTION check_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
    unbalanced RECORD;
BEGIN
    SELECT
        e.transaction_id,
        e.currency,
        SUM(CASE WHEN e.direction = 'in'  THEN e.amount ELSE 0 END) AS total_in,
        SUM(CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END) AS total_out
    INTO unbalanced
    FROM entries e
    WHERE e.transaction_id = NEW.transaction_id
    GROUP BY e.transaction_id, e.currency
    HAVING SUM(CASE WHEN e.direction = 'in'  THEN e.amount ELSE 0 END)
        <> SUM(CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'ENTRIES_UNBALANCED: transaction=% currency=% in=% out=% diff=%',
            unbalanced.transaction_id,
            unbalanced.currency,
            unbalanced.total_in,
            unbalanced.total_out,
            unbalanced.total_in - unbalanced.total_out
            USING ERRCODE = '23514'; -- check_violation SQLSTATE
    END IF;

    RETURN NULL; -- AFTER triggers ignore the return value
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entries_balanced_check
AFTER INSERT ON entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_transaction_balanced();
