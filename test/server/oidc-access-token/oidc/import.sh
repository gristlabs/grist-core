#!/usr/bin/env bash
set -euo pipefail
# This file sets up a fresh keycloak installation:
# - A new realm defined in env REALM
# - An OIDC client for Grist
# - An OIDC client for an intranet application
# - An OIDC client for an audit system
# 
# Roles on Grist, which are made available to the intranet and audit clients

## Define functions
function add-user () {
  if ! /opt/keycloak/bin/kcadm.sh get users -r $REALM -q username=${1,} | grep -q '"username"'; then
    KC_UID=$(/opt/keycloak/bin/kcadm.sh create users -r $REALM -s username=${1,} -s enabled=true -i)
    /opt/keycloak/bin/kcadm.sh set-password -r $REALM --userid "$KC_UID" --new-password "$1"
  fi
  KC_UID=$(/opt/keycloak/bin/kcadm.sh get users -r $REALM -q username=${1,} | jq -r '.[0].id')
  /opt/keycloak/bin/kcadm.sh update users/$KC_UID -r $REALM  -s 'emailVerified=true' -s "firstName=$1" -s 'lastName=User' -s "email=$3"
  /opt/keycloak/bin/kcadm.sh add-roles -r $REALM --uusername ${1,} --cclientid $CLIENT_ID --rolename $2

  echo "added user ${1,} as $2"
}

function create-client () {
  case $4 in
    confidential)
      standardFlowEnabled=true
      directAccessGrantsEnabled=false
      serviceAccountsEnabled=false
      ;;
    direct)
      standardFlowEnabled=false
      directAccessGrantsEnabled=true
      serviceAccountsEnabled=false
      ;;
    service)
      standardFlowEnabled=false
      directAccessGrantsEnabled=false
      serviceAccountsEnabled=true
      ;;
    *)
      echo "Unknown flow: $4" >&2
      return 1
  esac
  if ! /opt/keycloak/bin/kcadm.sh get clients -r $REALM -q clientId=$1 | grep -q '"clientId"'; then
    /opt/keycloak/bin/kcadm.sh create clients -r $REALM \
      -s clientId=$1 \
      -s publicClient=false \
      -s protocol=openid-connect
  fi
  # Some KC versions ignore 'secret' on create; update is reliable:
  cid=$(/opt/keycloak/bin/kcadm.sh get clients -r $REALM -q clientId=$1 | jq -r '.[0].id')
  /opt/keycloak/bin/kcadm.sh update clients/$cid -r $REALM \
    -s "secret=$2" \
    -s 'redirectUris=['"$3"']' \
    -s "serviceAccountsEnabled=$serviceAccountsEnabled" \
    -s "standardFlowEnabled=$standardFlowEnabled" \
    -s "directAccessGrantsEnabled=$directAccessGrantsEnabled" \
    -s 'fullScopeAllowed=false' >&2
  echo "Created client $1" >&2
  echo $cid
}

function create-client-role () {
  /opt/keycloak/bin/kcadm.sh create clients/$1/roles -r $REALM -s name=$2 -s "description=$3" || true
}
function add-scope-mapping () {
  dst_client_id=$1
  src_client_id=$2
}

/opt/keycloak/bin/kcadm.sh config credentials --server "$KEYCLOAK_URL" \
  --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
/opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE

# Get access token allowing rest modification
R="$REALM"
REALM=master
master_cli_cid=$(create-client "admin-cli" "admin-cli" "http://master.internal" "direct")
master_access_token=$(curl -sS -X POST "http://keycloak.localhost:8082/realms/master/protocol/openid-connect/token" -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=password" -d "client_id=admin-cli" -d "client_secret=admin-cli" -d "username=admin" -d "password=admin" -d "scope=openid" | jq -r '.access_token')
REALM="$R"

## Setup realm
if ! /opt/keycloak/bin/kcadm.sh get realms/$REALM >/dev/null 2>&1; then
  /opt/keycloak/bin/kcadm.sh create realms -s realm=$REALM -s enabled=true
fi
/opt/keycloak/bin/kcadm.sh update realms/$REALM -s sslRequired=NONE

GRIST_CID=$(create-client $CLIENT_ID $CLIENT_SECRET $REDIRECT_URI confidential)
INTRA_CID=$(create-client "intranet" "intranet" '"https://intranet.internal"' direct)
AUDIT_CID=$(create-client "audit" "audit" '"https://audit.internal"' service)
# create-client audit-service audit-password na service


# /opt/keycloak/bin/kcadm.sh create roles -r $REALM -s name=viewer || true
create-client-role $GRIST_CID editor "Editor can edit, and publish any document"
create-client-role $GRIST_CID viewer "Viewer can read any document"


# Allow clients to access roles
GRIST_ROLES="$(/opt/keycloak/bin/kcadm.sh get clients/$GRIST_CID/roles -r $REALM)"
VIEWER_ROLE="$(echo "$GRIST_ROLES" | jq -c '.[] | select(.name=="viewer") | [{id,name,description}]')"
EDITOR_ROLE="$(echo "$GRIST_ROLES" | jq -c '.[] | select(.name=="editor") | [{id,name,description}]')"
curl -sSX POST http://keycloak.localhost:8082/admin/realms/$REALM/clients/$INTRA_CID/scope-mappings/clients/$GRIST_CID \
  -H "Authorization: Bearer $master_access_token" \
  -H "Content-Type: application/json" \
  -d "$VIEWER_ROLE"
curl -sSX POST http://keycloak.localhost:8082/admin/realms/$REALM/clients/$INTRA_CID/scope-mappings/clients/$GRIST_CID \
  -H "Authorization: Bearer $master_access_token" \
  -H "Content-Type: application/json" \
  -d "$EDITOR_ROLE"

add-user tester viewer tester@example.com
add-user manager editor manager@example.com
add-user Chimpy viewer chimpy@getgrist.com

echo "Realm seeded."
