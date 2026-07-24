# Changelog

All notable changes to this project will be documented in this file.

## [0.14.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.13.0-alpha.1...@a2amesh/runtime-v0.14.0-alpha.1) (2026-07-24)


### Miscellaneous Chores

* **@a2amesh/runtime:** Synchronize A2A Mesh public packages versions


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.14.0-alpha.1

## [0.13.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.12.0-alpha.1...@a2amesh/runtime-v0.13.0-alpha.1) (2026-07-23)


### Bug Fixes

* **runtime:** make idempotency reservations atomic ([#192](https://github.com/oaslananka/a2amesh/issues/192)) ([07162a6](https://github.com/oaslananka/a2amesh/commit/07162a69367298e6a067f284aa98edf2f143f7bc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.13.0-alpha.1

## [0.12.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.11.0-alpha.1...@a2amesh/runtime-v0.12.0-alpha.1) (2026-07-22)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))
* **runtime:** enforce declared authentication requirements ([#189](https://github.com/oaslananka/a2amesh/issues/189)) ([6ff6adb](https://github.com/oaslananka/a2amesh/commit/6ff6adb3577f042f20c02acc90534c24b5bb9f48))
* **runtime:** harden outbound HTTP policy boundaries ([#158](https://github.com/oaslananka/a2amesh/issues/158)) ([e0dd4c4](https://github.com/oaslananka/a2amesh/commit/e0dd4c412a4edaf93ff6f12ddf7d52b4058ea2e9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.12.0-alpha.1

## [0.11.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.10.0-alpha.1...@a2amesh/runtime-v0.11.0-alpha.1) (2026-07-14)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.11.0-alpha.1

## [0.10.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.9.0-alpha.1...@a2amesh/runtime-v0.10.0-alpha.1) (2026-07-09)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.10.0-alpha.1

## [0.9.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.8.0-alpha.1...@a2amesh/runtime-v0.9.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.9.0-alpha.1

## [0.8.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.7.0-alpha.1...@a2amesh/runtime-v0.8.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.8.0-alpha.1

## [0.7.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.6.0-alpha.1...@a2amesh/runtime-v0.7.0-alpha.1) (2026-07-08)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* Agent Card trust log + registry-ui conformance/controls tabs ([#122](https://github.com/oaslananka/a2amesh/issues/122)) ([dbb1772](https://github.com/oaslananka/a2amesh/commit/dbb17722c8e962c4bdbe5ed5bbe170f83a56da33))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.7.0-alpha.1

## [0.6.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.5.0-alpha.1...@a2amesh/runtime-v0.6.0-alpha.1) (2026-07-05)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.6.0-alpha.1

## [0.5.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.4.0-alpha.1...@a2amesh/runtime-v0.5.0-alpha.1) (2026-07-04)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.5.0-alpha.1

## [0.4.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.3.0-alpha.1...@a2amesh/runtime-v0.4.0-alpha.1) (2026-07-04)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.4.0-alpha.1

## [0.3.0-alpha.1](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.2.0-alpha.1...@a2amesh/runtime-v0.3.0-alpha.1) (2026-07-03)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))
* complete roadmap foundation for security, storage, conformance, and local agent mesh ([#94](https://github.com/oaslananka/a2amesh/issues/94)) ([06c8013](https://github.com/oaslananka/a2amesh/commit/06c80139389cc87e92548b7ccb1ecd65c0c80c8c))
* **protocol:** align task lifecycle with A2A v1 config ([#56](https://github.com/oaslananka/a2amesh/issues/56)) ([0f00d66](https://github.com/oaslananka/a2amesh/commit/0f00d669e64a22b317d4499ed0333adfeebc36bf))
* **protocol:** enforce A2A version negotiation on streaming transports ([#42](https://github.com/oaslananka/a2amesh/issues/42)) ([775700a](https://github.com/oaslananka/a2amesh/commit/775700a4b4337206b8fae24e358bff05b7645697))
* **registry:** harden tenant trust ([#64](https://github.com/oaslananka/a2amesh/issues/64)) ([0d1bdfd](https://github.com/oaslananka/a2amesh/commit/0d1bdfd1763f5eb1648cf78c241c79f5fd74d8db))
* **runtime:** accept A2A JSON media types ([#46](https://github.com/oaslananka/a2amesh/issues/46)) ([990ae4c](https://github.com/oaslananka/a2amesh/commit/990ae4c41271b61126676cb7e97d88c0fea3352b))
* **runtime:** align REST error and pagination semantics ([#44](https://github.com/oaslananka/a2amesh/issues/44)) ([f19d750](https://github.com/oaslananka/a2amesh/commit/f19d7504547457f2e1ed081460fff686a7dcbae5))
* **runtime:** enforce REST tenant alias scope ([#45](https://github.com/oaslananka/a2amesh/issues/45)) ([e435051](https://github.com/oaslananka/a2amesh/commit/e435051cfc2cec362435199344a10fa9fb11aced))
* **runtime:** harden sqlite task storage initialization ([#75](https://github.com/oaslananka/a2amesh/issues/75)) ([12a072d](https://github.com/oaslananka/a2amesh/commit/12a072d54e48257d28c54cac2c687e426cfe6e8a))
* **runtime:** support task push notification config CRUD ([#43](https://github.com/oaslananka/a2amesh/issues/43)) ([3e6ff62](https://github.com/oaslananka/a2amesh/commit/3e6ff621a4af88d5f3ee295d7b00217a35a94f16))


### Bug Fixes

* recover M0 release and repo health checks ([#40](https://github.com/oaslananka/a2amesh/issues/40)) ([e679400](https://github.com/oaslananka/a2amesh/commit/e679400e057b6adc2d9a524c8d2870fb5da6dd81))
* remove @opentelemetry/api from runtime peerDependencies ([fae0c70](https://github.com/oaslananka/a2amesh/commit/fae0c70e3783bb4c176957507c3e80532f7ef75c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.3.0-alpha.1

## [0.2.0-alpha.0](https://github.com/oaslananka/a2amesh/compare/@a2amesh/runtime-v0.1.0-alpha.0...@a2amesh/runtime-v0.2.0-alpha.0) (2026-06-28)


### Features

* add TypeScript configuration and runtime versions ([f4d5d6d](https://github.com/oaslananka/a2amesh/commit/f4d5d6dca177aaab8454d706ae21a3522ad33223))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @a2amesh/protocol bumped to 0.2.0-alpha.0

## 0.1.0-alpha.0 (2026-06-27)

### Features

- Initial release of A2A Mesh workspace packages.
