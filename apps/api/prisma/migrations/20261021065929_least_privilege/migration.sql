-- The API only reads organizations and users. Sessions are created and revoked by the API.
REVOKE INSERT, UPDATE, DELETE ON organizations FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON users FROM app_user;
