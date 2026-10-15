#!/bin/bash
# One-time: creates a local self-signed code-signing certificate, in its own keychain,
# for build.sh. macOS ties the Screen Recording permission to a program's signature; an
# ad-hoc signature changes with every build, a certificate signature doesn't. So with
# this, rebuilding no longer means approving the permission again.
set -e
NAME="USB-C Display Local Signing"
KEYCHAIN="$HOME/Library/Keychains/usbc-display-signing.keychain-db"
PASS="usbc-display"  # only protects this keychain, which holds nothing but this certificate

if [ -f "$KEYCHAIN" ] && security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cfg" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$TMP/cert.cfg" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" -passout "pass:$PASS"

[ -f "$KEYCHAIN" ] || security create-keychain -p "$PASS" "$KEYCHAIN"
security unlock-keychain -p "$PASS" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"  # don't auto-lock
security import "$TMP/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KEYCHAIN" >/dev/null
echo "Created the \"$NAME\" certificate."
