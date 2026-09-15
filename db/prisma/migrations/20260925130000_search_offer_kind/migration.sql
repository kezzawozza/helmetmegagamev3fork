-- Search (docs/systemdocs/SEARCH.md): a consent verb for looking through
-- somebody's pockets, the Offer handshake Kiss and Bind already share.
--
-- The enum value is ALONE in its own migration on purpose. Postgres refuses
-- to USE a value added to an enum in the same transaction that added it, so
-- the columns that go with this feature are the next migration along
-- (..._search_columns). Splitting them is what lets `migrate deploy` apply
-- both in one run without tripping over itself.

ALTER TYPE "OfferKind" ADD VALUE IF NOT EXISTS 'SEARCH';
