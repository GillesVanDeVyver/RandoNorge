-- Remove every account that has not chosen a public username, plus all of
-- its dependent rows. Children are deleted explicitly (rather than trusting
-- ON DELETE CASCADE) so the result is identical whether or not foreign-key
-- enforcement is on. "No username" = NULL or blank.

DELETE FROM verification
 WHERE identifier IN (
   SELECT email FROM "user" WHERE username IS NULL OR trim(username) = ''
 );

DELETE FROM track
 WHERE "userId" IN (
   SELECT id FROM "user" WHERE username IS NULL OR trim(username) = ''
 );

DELETE FROM route
 WHERE "userId" IN (
   SELECT id FROM "user" WHERE username IS NULL OR trim(username) = ''
 );

DELETE FROM session
 WHERE "userId" IN (
   SELECT id FROM "user" WHERE username IS NULL OR trim(username) = ''
 );

DELETE FROM account
 WHERE "userId" IN (
   SELECT id FROM "user" WHERE username IS NULL OR trim(username) = ''
 );

DELETE FROM "user"
 WHERE username IS NULL OR trim(username) = '';
