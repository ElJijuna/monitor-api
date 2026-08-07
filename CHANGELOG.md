# [1.2.0](https://github.com/ElJijuna/monitor-api/compare/v1.1.1...v1.2.0) (2026-08-07)


### Bug Fixes

* enhance PerformanceCollector to prevent multiple starts and reset state on stop ([8106cf9](https://github.com/ElJijuna/monitor-api/commit/8106cf9b9c86080b424f9cb56239d7b7bf429dfa))


### Features

* enhance NetworkCollector to accurately measure response payload sizes without cloning responses ([5e63d5d](https://github.com/ElJijuna/monitor-api/commit/5e63d5d4b9c91644d6996d84d93ae0743a4dfa4d))
* enhance production reporting to exclude sensitive data by default and implement custom payload transformation ([88983fa](https://github.com/ElJijuna/monitor-api/commit/88983faaa953bffb2cc7de8c315b9f26725342ae))
* enhance ReactCollector to track truncated commits and improve unmount handling ([0c1ba21](https://github.com/ElJijuna/monitor-api/commit/0c1ba218dfcf36603c29429eda8f0723266b7c89))
* implement maxHistory functionality across collectors and add tests for zero history retention ([beccca5](https://github.com/ElJijuna/monitor-api/commit/beccca58cf16cfe655cda4e593f54a21bd35eaff))
* implement shared global hooks for NetworkCollector and ReactCollector, allowing independent operation and preserving third-party patches ([bf13c43](https://github.com/ElJijuna/monitor-api/commit/bf13c438f2b4e97c8c89f807521ea30199d57be2))
* implement window5s expiration logic in NetworkCollector and add related tests ([6f78122](https://github.com/ElJijuna/monitor-api/commit/6f78122cd792480947ed91b48e333e534cb9aba0))
* improve production reporting to handle transform and serialization errors, ensuring continuous operation without overlapping requests ([a68a3d5](https://github.com/ElJijuna/monitor-api/commit/a68a3d52f9b05bc20abb92506d284085bf6ac22e))

## [1.1.1](https://github.com/ElJijuna/monitor-api/compare/v1.1.0...v1.1.1) (2026-06-06)


### Bug Fixes

* update TypeScript and type definitions for compatibility ([2d5735d](https://github.com/ElJijuna/monitor-api/commit/2d5735dbf2d43ba521d524c4d55a4bd009d53389))

# [1.1.0](https://github.com/ElJijuna/monitor-api/compare/v1.0.1...v1.1.0) (2026-05-29)


### Features

* add WebVitalsCollector with web-vitals integration ([252aa1b](https://github.com/ElJijuna/monitor-api/commit/252aa1b359dfe226141cf4439ea37b53fb0ea8b5))

## [1.0.1](https://github.com/ElJijuna/monitor-api/compare/v1.0.0...v1.0.1) (2026-05-29)


### Bug Fixes

* defer production reporter until monitor start ([4e1a4f3](https://github.com/ElJijuna/monitor-api/commit/4e1a4f3267cb8422b08ce62cb2a683e33aaef393))
* derive event label stats from retained history ([7206f4e](https://github.com/ElJijuna/monitor-api/commit/7206f4ec66dee76356088e811b8962a42cb212df))
* harden production runtime lifecycle ([030ccae](https://github.com/ElJijuna/monitor-api/commit/030ccaece06bf1ad1d5a8c8a9657af875250ece5))

# 1.0.0 (2026-05-29)


### Bug Fixes

* change order in type for solve warns in compilation, types first! ([3e62a7d](https://github.com/ElJijuna/monitor-api/commit/3e62a7d81ad97fbc3499519ea6797cbec335a9cd))


### Features

* optimize byComponent to prevent infinite store ([e1c00e2](https://github.com/ElJijuna/monitor-api/commit/e1c00e2af16f3c7153235f429022225ec1e16869))
* scaffold monitor-api with signal-based collectors ([1337e27](https://github.com/ElJijuna/monitor-api/commit/1337e27e2ed5d7c283f942eb3e1d4c70945556db))
