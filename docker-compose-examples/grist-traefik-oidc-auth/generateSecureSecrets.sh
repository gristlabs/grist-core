# Helper script to securely generate random secrets for Authelia.

# If this doesn't work on your platform, here are some alternate snippets for secure string generation:
# Python:
# python -c "import secrets; print(secrets.token_urlsafe(32))"
# Javascript / Node:
# node -e "console.log(crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''))"

SCRIPT_DIR=$(dirname $0)

function generateSecureString {
  xxd -l"$1" -ps /dev/urandom | xxd -r -ps | base64 \
    | tr -d = | tr + - | tr / _ | tr -d \\n
}

generateSecureString 64 > "$SCRIPT_DIR/secrets/JWT_SECRET"
generateSecureString 64 > "$SCRIPT_DIR/secrets/SESSION_SECRET"
generateSecureString 64 > "$SCRIPT_DIR/secrets/STORAGE_ENCRYPTION_KEY"
