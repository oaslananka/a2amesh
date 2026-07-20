#!/bin/sh
set -eu
exec renovate-config-validator --strict "${RENOVATE_CONFIG_FILE:?RENOVATE_CONFIG_FILE is required}"
