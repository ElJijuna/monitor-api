# Browser compatibility

The distributed package targets ES2020 and is exercised end to end against the
three browser engines through Playwright on every pull request.

| Capability | Chromium | Firefox | WebKit | Fallback |
| --- | :---: | :---: | :---: | --- |
| Core signals and custom events | Tested | Tested | Tested | — |
| Fetch and XHR instrumentation | Tested | Tested | Tested | Missing APIs are skipped |
| Error and rejection capture | Tested | Tested | Tested | Missing browser globals are skipped |
| Web Vitals | Tested | Tested | Tested | Unsupported metrics remain `null` |
| FPS | Tested | Tested | Tested | Requires `requestAnimationFrame` |
| JS heap memory | Supported | `null` | `null` | Chromium-only `performance.memory` |
| Long Tasks | Feature detected | Feature detected | Feature detected | Empty aggregate when unsupported |
| React commit collection | Feature detected | Feature detected | Feature detected | Requires the React DevTools global hook |
| Server-side import/start | Tested in Node | Tested in Node | Tested in Node | Browser collectors no-op |

“Tested” means the demo smoke flow loads the published build shape and validates
events, fetch, XHR, errors, reporting, and snapshots in Playwright's current
Chromium, Firefox, and WebKit revisions. Native metric availability still depends
on each engine. The collectors feature-detect optional platform APIs and retain
`null` or empty values when an API is absent.

Run the same matrix locally with:

```sh
npx playwright install chromium firefox webkit
npm run test:browser
```

Older browsers must support the ES2020 output and the APIs used by the enabled
collectors. Applications that target older syntax should transpile the package
as part of their own build.
