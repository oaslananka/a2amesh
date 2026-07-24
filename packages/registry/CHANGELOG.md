# Changelog

All notable changes to this project will be documented in this file.

## [0.14.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.13.0-alpha.1...@a2amesh/registry-v0.14.0-alpha.1) (2026-07-24)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **deploy:** add production Helm chart ([#161](https://github.com/oaslananka/a2amesh/issues/161)) ([66f515f](https://github.com/oaslananka/a2amesh/commit/66f515fb585d9de4b0ae3a0c9544df6bf0daebe2))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **dx:** make clean install bin linking deterministic ([#206](https://github.com/oaslananka/a2amesh/issues/206)) ([c35d014](https://github.com/oaslananka/a2amesh/commit/c35d0146fbcb1bf92bd1b18d9d1d9e97e5d5c390)), closes [#147](https://github.com/oaslananka/a2amesh/issues/147)
* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))
* **runtime:** enforce declared authentication requirements ([#189](https://github.com/oaslananka/a2amesh/issues/189)) ([6ff6adb](https://github.com/oaslananka/a2amesh/commit/6ff6adb3577f042f20c02acc90534c24b5bb9f48))
* **runtime:** harden outbound HTTP policy boundaries ([#158](https://github.com/oaslananka/a2amesh/issues/158)) ([e0dd4c4](https://github.com/oaslananka/a2amesh/commit/e0dd4c412a4edaf93ff6f12ddf7d52b4058ea2e9))
* **security:** restore SonarCloud new-code rating ([#194](https://github.com/oaslananka/a2amesh/issues/194)) ([2bad9b9](https://github.com/oaslananka/a2amesh/commit/2bad9b9f815935a8a8713d901ab4f2b1d2c938fe)), closes [#193](https://github.com/oaslananka/a2amesh/issues/193)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.14.0-alpha.1

## [0.13.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.12.0-alpha.1...@a2amesh/registry-v0.13.0-alpha.1) (2026-07-23)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **deploy:** add production Helm chart ([#161](https://github.com/oaslananka/a2amesh/issues/161)) ([66f515f](https://github.com/oaslananka/a2amesh/commit/66f515fb585d9de4b0ae3a0c9544df6bf0daebe2))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))
* **runtime:** enforce declared authentication requirements ([#189](https://github.com/oaslananka/a2amesh/issues/189)) ([6ff6adb](https://github.com/oaslananka/a2amesh/commit/6ff6adb3577f042f20c02acc90534c24b5bb9f48))
* **runtime:** harden outbound HTTP policy boundaries ([#158](https://github.com/oaslananka/a2amesh/issues/158)) ([e0dd4c4](https://github.com/oaslananka/a2amesh/commit/e0dd4c412a4edaf93ff6f12ddf7d52b4058ea2e9))
* **security:** restore SonarCloud new-code rating ([#194](https://github.com/oaslananka/a2amesh/issues/194)) ([2bad9b9](https://github.com/oaslananka/a2amesh/commit/2bad9b9f815935a8a8713d901ab4f2b1d2c938fe)), closes [#193](https://github.com/oaslananka/a2amesh/issues/193)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.13.0-alpha.1

## [0.12.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.11.0-alpha.1...@a2amesh/registry-v0.12.0-alpha.1) (2026-07-22)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **deploy:** add production Helm chart ([#161](https://github.com/oaslananka/a2amesh/issues/161)) ([66f515f](https://github.com/oaslananka/a2amesh/commit/66f515fb585d9de4b0ae3a0c9544df6bf0daebe2))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))
* **runtime:** enforce declared authentication requirements ([#189](https://github.com/oaslananka/a2amesh/issues/189)) ([6ff6adb](https://github.com/oaslananka/a2amesh/commit/6ff6adb3577f042f20c02acc90534c24b5bb9f48))
* **runtime:** harden outbound HTTP policy boundaries ([#158](https://github.com/oaslananka/a2amesh/issues/158)) ([e0dd4c4](https://github.com/oaslananka/a2amesh/commit/e0dd4c412a4edaf93ff6f12ddf7d52b4058ea2e9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.12.0-alpha.1

## [0.11.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.10.0-alpha.1...@a2amesh/registry-v0.11.0-alpha.1) (2026-07-14)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.11.0-alpha.1

## [0.10.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.9.0-alpha.1...@a2amesh/registry-v0.10.0-alpha.1) (2026-07-09)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.10.0-alpha.1

## [0.9.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.8.0-alpha.1...@a2amesh/registry-v0.9.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.9.0-alpha.1

## [0.8.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.7.0-alpha.1...@a2amesh/registry-v0.8.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.8.0-alpha.1

## [0.7.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.6.0-alpha.1...@a2amesh/registry-v0.7.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* **registry,fleet-server:** add SQLite-backed persistence for trust log and fleet storage ([#124](https://github.com/oaslananka/a2amesh/issues/124)) ([b0aa8b1](https://github.com/oaslananka/a2amesh/commit/b0aa8b1a50def38df5c7d782c9ad818c2f2fc57e))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Bug Fixes

* **registry:** explicit sort comparator in trust-log canonicalization ([#123](https://github.com/oaslananka/a2amesh/issues/123)) ([e4f6577](https://github.com/oaslananka/a2amesh/commit/e4f6577f656cd01b52b12ed56c24896d0552ab5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.7.0-alpha.1

## [0.6.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.5.0-alpha.1...@a2amesh/registry-v0.6.0-alpha.1) (2026-07-05)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.6.0-alpha.1

## [0.5.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.4.0-alpha.1...@a2amesh/registry-v0.5.0-alpha.1) (2026-07-04)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.5.0-alpha.1

## [0.4.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.3.0-alpha.1...@a2amesh/registry-v0.4.0-alpha.1) (2026-07-04)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.4.0-alpha.1

## [0.3.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.2.0-alpha.1...@a2amesh/registry-v0.3.0-alpha.1) (2026-07-03)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* **registry:** align HTTP error semantics ([#47](https://github.com/oaslananka/a2amesh/issues/47)) ([bf48a0f](https://github.com/oaslananka/a2amesh/commit/bf48a0fa4c7334e01fa6fab7e30d62c1d1e0f459))
* **registry:** expose agent pagination headers ([#48](https://github.com/oaslananka/a2amesh/issues/48)) ([6b928ff](https://github.com/oaslananka/a2amesh/commit/6b928ff099ab857112166cdc8b56abc7cbed4101))
* **registry:** harden redis polling ([#63](https://github.com/oaslananka/a2amesh/issues/63)) ([045d035](https://github.com/oaslananka/a2amesh/commit/045d035051be5a7cc351c189254882c584544356))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.3.0-alpha.1

## [0.2.0-alpha.0](https://github.com/oaslananka/a2amesh/compare/@a2amesh/registry-v0.1.0-alpha.0...@a2amesh/registry-v0.2.0-alpha.0) (2026-06-28)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/runtime bumped to 0.2.0-alpha.0

## 0.1.0-alpha.0 (2026-06-27)

### Features

- Initial release of A2A Mesh workspace packages.
