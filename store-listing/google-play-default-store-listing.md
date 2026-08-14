# Google Play Console — Default Store Listing

Copy-paste source for **Grow → Store presence → Main store listing** (shown
as "Default store listing" when you only have one language configured).
Each field below is under its own heading so you can copy just the block
you need.

---

## App name
_(max 30 characters)_

```
The Oracle App
```

Alt, if you want the org name visible in search (28 characters):

```
Oracle - CFC West1C1 Portal
```

---

## Short description
_(max 80 characters — this one is 75)_

```
CFC West1C1's official members portal for directory, formation & messaging.
```

---

## Full description
_(max 4000 characters)_

```
Oracle is the official members portal for CFC West1C1 (Couples for Christ – West 1, Cluster 1), built for our area coordinators, moderators, and members to manage household records, track formation progress, and stay connected across the community.

KEY FEATURES

• Member Directory — view and manage household, Area/Chapter, and Pastoral Service assignments
• Formation Tracking — track Pastoral Formation (PFO) and Christian Life Program (CLP) module completion for every member
• Change Requests — propose record updates that a moderator or admin reviews and approves before they take effect, keeping our records accurate and auditable
• Secure Messaging — coordinate directly with moderators and area leaders inside the app
• Role-Based Access — every account only sees the Areas and pages its assigned role is authorized for
• Push Notifications — get notified the moment you receive a new message

WHO THIS APP IS FOR

Oracle is a private portal for CFC West1C1 members and staff only. An authorized account is required to sign in — there is no public self-signup. If you're part of CFC West1C1 and need portal access, contact your Area Coordinator or a portal Administrator.

PRIVACY

Your privacy matters to us. See our full Privacy Policy for details on what data we collect and how it's protected:
<your deployed web URL>/privacy-policy
```

Replace `<your deployed web URL>` with wherever the web build is actually
hosted (e.g. `https://oracle.cfcwest1c1.org` or your Vercel/Expo hosting
domain) once you have one.

---

## App category

Play Console requires exactly one primary category. There's no dedicated
"Church"/"Ministry" option, so the closest fits are:

- **Lifestyle** (recommended — broadest fit for a community/org membership app)
- **Business** (alternate, if you'd rather frame it as an internal org tool)

---

## Contact details

_(required on this same page)_

```
Email: jamesryanpatiag@gmail.com
```

Phone and website are optional — add them if you have a public number or
site for the org.

---

## Not on this page, but needed for the same submission

- **Privacy Policy URL** (Play Console → Policy → App content → Privacy
  policy): use the same `<your deployed web URL>/privacy-policy` link
  above. Required before you can publish to any track beyond internal
  testing.
- **App icon** (512×512, 32-bit PNG, ≤1024KB): `assets/images/icon.png`
  in this repo is 1024×1024 — downscale it to 512×512 for the upload.
- **Feature graphic** (1024×500 JPG/PNG): not yet created — let me know if
  you want one designed from the same navy/logo branding.
- **Phone screenshots** (min 2, JPG/PNG, 16:9 or 9:16): take these from a
  running build (`eas build --profile preview` or a dev client) once
  you're ready to submit.
