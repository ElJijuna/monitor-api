# [1.9.0](https://github.com/ElJijuna/monitor-api/compare/v1.8.0...v1.9.0) (2026-09-30)


### Bug Fixes

* add comprehensive tests for EventCollector's data limits and behavior ([a2bd7aa](https://github.com/ElJijuna/monitor-api/commit/a2bd7aafeecffa305134fce3cd9597e843d7deb5))
* add tests for ReactCollector's behavior on component unmounts and DevTools hook installation ([4806f3f](https://github.com/ElJijuna/monitor-api/commit/4806f3f21de211bf8d45cec3f2ba64578610277c))
* add tests to ensure no expiry timer is left behind when stopping from filters or onRequest subscribers ([4632a2f](https://github.com/ElJijuna/monitor-api/commit/4632a2f8edcaceae1d156618946bc62dfa15f220))
* enhance retry logic in createReporter and add tests for shouldRetry behavior ([dd8ecc2](https://github.com/ElJijuna/monitor-api/commit/dd8ecc2c4b425ac2168c8858b784a9cd2ba1d940))
* enhance URL classification logic in ResourceCollector and add related tests ([5b270f5](https://github.com/ElJijuna/monitor-api/commit/5b270f53002b20875e34b40fc530befac89cac5a))
* improve metric recording logic in WebVitalsCollector and add tests for attribution behavior ([e4f9b50](https://github.com/ElJijuna/monitor-api/commit/e4f9b5063a58384ea4c576f91579a3a06ed2beb0))
* simplify update logic in PerformanceCollector to ensure proper memory reading ([54decf2](https://github.com/ElJijuna/monitor-api/commit/54decf25e8a07480f733bc54cd4e16ce5d7c4e96))
* update readConnection function to handle null values and improve DeviceCollector's connection update logic ([2f545b1](https://github.com/ElJijuna/monitor-api/commit/2f545b1b1cff299d58500e457fda345eb7f80530))


### Features

* enhance DeviceCollector to gather comprehensive device information ([278a659](https://github.com/ElJijuna/monitor-api/commit/278a659a228cf29fd777672ecfa4d596a5c6f095))
* update DeviceCollector to read screen and viewport sizes once a resize settles, enhance related tests ([fe99d82](https://github.com/ElJijuna/monitor-api/commit/fe99d82179cc3ee33ad9d27fcc1552625b5ce886))

# [1.8.0](https://github.com/ElJijuna/monitor-api/compare/v1.7.1...v1.8.0) (2026-09-29)


### Features

* add DeviceCollector to monitor logical processor count and update related documentation and tests ([29f0677](https://github.com/ElJijuna/monitor-api/commit/29f0677bca63121cad48ef203c0e40f731ea4ff1))
* add memory measurement support using performance.measureUserAgentSpecificMemory() in cross-origin isolated pages, update related documentation and tests ([12a1b4f](https://github.com/ElJijuna/monitor-api/commit/12a1b4f5ae3b9c6bb281eef279942cabee185047))
* enhance DeviceCollector to track online status and offline transitions, update related documentation and tests ([990094b](https://github.com/ElJijuna/monitor-api/commit/990094b402b599612b5e8c3b918e0d6578d63308))
* enhance memory measurement to include per-frame and per-worker context details, update related tests and documentation ([980af10](https://github.com/ElJijuna/monitor-api/commit/980af10d1cc409f3b0fd2d91040f46acc3fe8d5c))
* enhance performance monitoring by adding freeze/resume event handling and updating tests ([e8b374a](https://github.com/ElJijuna/monitor-api/commit/e8b374a6f72c3ffbe030616e0ea8afce3a73882c))
* pause memory sampling when the document is hidden and update tests ([0d6ecd4](https://github.com/ElJijuna/monitor-api/commit/0d6ecd49dabdb3c2910450915c06010f50e7890c))

## [1.7.1](https://github.com/ElJijuna/monitor-api/compare/v1.7.0...v1.7.1) (2026-09-29)


### Bug Fixes

* update ssignal dependency to version 1.9.1 and remove shallowEqual usage in PerformanceCollector ([0d832d7](https://github.com/ElJijuna/monitor-api/commit/0d832d71848a6d6aca2abd3030aeebff817280b5))

# [1.7.0](https://github.com/ElJijuna/monitor-api/compare/v1.6.0...v1.7.0) (2026-09-29)


### Features

* implement batching for performance updates and add shallowEqual utility for efficient comparisons ([8bec9bc](https://github.com/ElJijuna/monitor-api/commit/8bec9bcaf75fe4da73ce1ee4a31a8a375cada0ad))

# [1.6.0](https://github.com/ElJijuna/monitor-api/compare/v1.5.0...v1.6.0) (2026-09-29)


### Bug Fixes

* do not count a completed delivery as cancelled when stopped while recording it ([5be5528](https://github.com/ElJijuna/monitor-api/commit/5be55281621d5759420dd131c0b62ba4ab98bf99))


### Features

* add Long Animation Frames with script attribution ([59a0a4d](https://github.com/ElJijuna/monitor-api/commit/59a0a4db538e7a57d6f90eeea16646ab8774bb65))
* update ReactCollector to use SSignal for slowThreshold and enhance snapshot computation ([c0e393a](https://github.com/ElJijuna/monitor-api/commit/c0e393a4df494714742946d23837a0f2cc973c6a))
* web-vitals report metrics per soft navigation with navigation ids and URLs ([5ff05cf](https://github.com/ElJijuna/monitor-api/commit/5ff05cf2c728044ff31df22beb84d1e7d2d182bc))


### Performance Improvements

* cover network, errors and reporter paths and report sample spread ([411741d](https://github.com/ElJijuna/monitor-api/commit/411741d9fa2be15a55a9ac024527764a8c5267b7))
* decide report and event size limits from string length before encoding ([1ee4a33](https://github.com/ElJijuna/monitor-api/commit/1ee4a33aa96feb3a80288c9812c217414d8afe8b))
* keep 5 s window totals in a time-ordered queue instead of rescanning buckets ([1540a52](https://github.com/ElJijuna/monitor-api/commit/1540a527ccd4e01305d99f2dce02562971e9a780))
* react,events update component and label statistics from history changes instead of recomputing them ([87efa54](https://github.com/ElJijuna/monitor-api/commit/87efa54786957ba443e88d65d7f0eda45de544ad))

# [1.5.0](https://github.com/ElJijuna/monitor-api/compare/v1.4.0...v1.5.0) (2026-09-29)


### Bug Fixes

* count only real renders and report self durations ([4c936da](https://github.com/ElJijuna/monitor-api/commit/4c936da7c1e9a43b3fdf3c40dbc24875f0c56e07))
* enhance timeout handling in ProductionReportConfig and add related tests ([b9691f8](https://github.com/ElJijuna/monitor-api/commit/b9691f8ba6409660062ebb5850aa43130c42a7e7))
* update esbuild override to use variable reference ([a8a60fe](https://github.com/ElJijuna/monitor-api/commit/a8a60fe7845150b2fca75743dc04f3aa6f78d37b))


### Features

* add exclusion for reporter endpoint in NetworkCollector and update tests ([8e2df7d](https://github.com/ElJijuna/monitor-api/commit/8e2df7d68e54a82e99e5d52ff74025f4cfaefa27))
* add Resource Timing collector for monitoring page assets ([1b079ca](https://github.com/ElJijuna/monitor-api/commit/1b079ca1ba17add5d69ba969fe8fdecd8aae62c3))
* add Web Vitals attribution for enhanced diagnostics and reporting ([15b7ae0](https://github.com/ElJijuna/monitor-api/commit/15b7ae0635e7d00084c5d47364b8abbd52629c20))
* enhance ReactCollector and createMonitor with resource management and performance optimizations ([f285cbc](https://github.com/ElJijuna/monitor-api/commit/f285cbc9d98103f1eefd893f228fc08f063f4738))
* implement keepalive reporting for hidden/unloaded pages and add related tests ([5d224d3](https://github.com/ElJijuna/monitor-api/commit/5d224d3492977f17d3d10edb489c5210565841ae))
* implement selector-based reactivity in hooks for optimized rendering ([1e24b24](https://github.com/ElJijuna/monitor-api/commit/1e24b2461e4bb7b156c01d8977ec3a11894f4847))
* optimize error deduplication logic in ErrorCollector and add corresponding test ([a964a24](https://github.com/ElJijuna/monitor-api/commit/a964a24d08387ba34c8f63886e921ac5aec30fa8))
* update build process and add package verification tests ([62249ae](https://github.com/ElJijuna/monitor-api/commit/62249aed04f7f4270da4ec1aa670811e1e927934))

# [1.4.0](https://github.com/ElJijuna/monitor-api/compare/v1.3.0...v1.4.0) (2026-09-07)


### Features

* add error collector for capturing and managing JavaScript errors ([187f4e5](https://github.com/ElJijuna/monitor-api/commit/187f4e57ed68ccd4fd697f70d8130cdb93935daa))
* add Playwright testing setup and demo tests ([22b6157](https://github.com/ElJijuna/monitor-api/commit/22b6157c1769f52ffbdcda8a6fe84385156aeb10))
* enhance Playwright testing setup; add browser compatibility and privacy guides ([23a0c74](https://github.com/ElJijuna/monitor-api/commit/23a0c7497910716665231dfec9d2b4ecceaf8e74))

# [1.3.0](https://github.com/ElJijuna/monitor-api/compare/v1.2.0...v1.3.0) (2026-08-08)


### Features

* add sampling support and production reporting enhancements, including custom transport and retry policies ([aed3b25](https://github.com/ElJijuna/monitor-api/commit/aed3b2582b6d6f73acc9cc147e3e87027dbe6691))
* enhance EventCollector to validate and limit event data, improving data integrity and isolation ([4d8c7aa](https://github.com/ElJijuna/monitor-api/commit/4d8c7aaa94cabbb9a5ce959670076149d4cac4da))

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
