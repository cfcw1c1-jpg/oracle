# Release notes

One markdown file per `eas build` run, written automatically by
`npm run build -- --platform <platform> --profile <profile>`
(see `scripts/eas-build.js`).

Each file records the app version, git commit/branch, platform, profile,
and whether the build ran against a clean or dirty working tree -- so you
can always trace a build back to exactly what code produced it. EAS Build
itself runs in Expo's cloud and only hands back a download link (via
`eas build:list` or the expo.dev dashboard); these files don't contain
the built binary, just a record that the build happened and with what.

Files are named `<version>_<platform>_<profile>_<timestamp>.md` and are
never overwritten -- every build gets its own file.
