# Helper script to securely generate random secrets for Authelia.

SCRIPT_DIR=$(dirname $0)

# Copy over template files to final locations
cp -R "$SCRIPT_DIR/secrets_template" "$SCRIPT_DIR/secrets"
cp "$SCRIPT_DIR/env-template" "$SCRIPT_DIR/.env"

# Parses an Aurelia generated secret for the value
function getSecret {
  cut -d ":" -f 2 <<< "$1" | tr -d '[:blank:]'
}

function generateSecureString {
  getSecret "$(docker run authelia/authelia:4 authelia crypto rand --charset=rfc3986 --length="$1")"
}

generateSecureString 128 > "$SCRIPT_DIR/secrets/HMAC_SECRET"
generateSecureString 128 > "$SCRIPT_DIR/secrets/JWT_SECRET"
generateSecureString 128 > "$SCRIPT_DIR/secrets/SESSION_SECRET"
generateSecureString 128 > "$SCRIPT_DIR/secrets/STORAGE_ENCRYPTION_KEY"

# Generates the OIDC secret key for the Grist client
CLIENT_SECRET_OUTPUT="$(docker run authelia/authelia:4 authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986)"
CLIENT_SECRET=$(getSecret "$(grep 'Password' <<< $CLIENT_SECRET_OUTPUT)")
sed -i "/GRIST_CLIENT_SECRET=$/d" "$SCRIPT_DIR/.env"
echo "GRIST_CLIENT_SECRET=$CLIENT_SECRET" >> "$SCRIPT_DIR/.env"
getSecret "$(grep 'Digest' <<< $CLIENT_SECRET_OUTPUT)" >> "$SCRIPT_DIR/secrets/GRIST_CLIENT_SECRET_DIGEST"

# Generate JWT certificates Authelia needs for OIDC
docker run -v ./secrets/certs:/certs authelia/authelia:4 authelia crypto certificate rsa generate -d /certs

