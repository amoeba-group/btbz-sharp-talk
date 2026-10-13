#!/bin/sh
# Image build step (Dockerfile.web): fill the console's frame-ancestors from the
# CONSOLE_FRAME_ANCESTORS build arg (PLN-261012 SG-80).
#
#   sh render-frame-ancestors.sh <nginx.conf> "<extra origins, space separated>"
#
# nginx.web.conf carries the placeholder __CONSOLE_FRAME_ANCESTORS__ in
#   add_header Content-Security-Policy "frame-ancestors __CONSOLE_FRAME_ANCESTORS__" always;
# It used to hard-code `'self' https://ama.amoeba.site` for every customer — Amoeba's own
# portal allowed to frame a customer's admin console. The result is always `'self'`
# plus whatever the operator lists; an empty list gives exactly `'self'`.
set -eu

conf="${1:-}"
extra="${2:-}"

[ -f "$conf" ] || { echo "usage: $0 <nginx.conf> [origins]" >&2; exit 2; }
grep -q '__CONSOLE_FRAME_ANCESTORS__' "$conf" || { echo "placeholder not found in $conf" >&2; exit 1; }

# The value lands inside a double-quoted nginx string and a sed expression: allow
# only what an origin list needs, so a stray quote or `;` cannot break the config.
if printf '%s' "$extra" | grep -q '[^A-Za-z0-9.:/* -]'; then
  echo "CONSOLE_FRAME_ANCESTORS may only contain origins (letters, digits, . : / - * and spaces), got: '$extra'" >&2
  exit 1
fi

# Collapse runs of spaces and trim, so " a   b " does not leave ragged policy text.
extra="$(printf '%s' "$extra" | tr -s ' ' | sed -e 's/^ //' -e 's/ $//')"

value="'self'"
[ -n "$extra" ] && value="'self' $extra"

sed -i "s|__CONSOLE_FRAME_ANCESTORS__|$value|" "$conf"
echo "render-frame-ancestors: frame-ancestors $value"
