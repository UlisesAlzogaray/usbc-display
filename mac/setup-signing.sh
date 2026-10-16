#!/bin/bash
# The local code-signing certificate build.sh signs with, in its own keychain. macOS ties the
# Screen Recording and Accessibility permissions to a program's signing certificate: an ad-hoc
# signature changes with every build, a certificate signature doesn't. So with this, rebuilding
# no longer means approving the permissions again.
#
#   bash setup-signing.sh            checks that the certificate is there (build.sh runs this)
#   bash setup-signing.sh --create   makes it, once per Mac
#
# It is never made again by itself: a new certificate is a new signature, and every privacy entry
# the old one has (switches already on in System Settings) would stop matching the app.
set -e
NAME="USB-C Display Local Signing"
KEYCHAIN="$HOME/Library/Keychains/usbc-display-signing.keychain-db"
PASS="usbc-display"  # only protects this keychain, which holds nothing but this certificate

if [ -f "$KEYCHAIN" ] && security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
    exit 0
fi
if [ "$1" != "--create" ]; then
    echo "error: no \"$NAME\" certificate in $KEYCHAIN." >&2
    echo "error: if this Mac never had one, run \"bash mac/setup-signing.sh --create\" once. If it had one, restore that" >&2
    echo "error: keychain instead: a new certificate makes the permissions already given to USB-C Display stop matching." >&2
    exit 1
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
