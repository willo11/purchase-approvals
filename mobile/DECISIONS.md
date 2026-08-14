# Mobile — Decision Log (Tradeoffs)

> Study material for the technical interview. This folder is implemented LAST
> (after backend + web frontend). Entries get appended as decisions are made
> during the mobile slice.

---

## 1. Mobile scope (decided at proposal time)
- **Tradeoff**: the assignment does NOT require a mobile app — it is an extra the user wants (also covers the React Native interview goals).
- **Decision**: MINIMAL study scope — create a purchase request + a screen showing the 3 approval links (open in browser; in-app deep link if simple). The approval flow itself lives on the web until proven easy to embed.
- **Why**: keeps the deliverable focused; RN adds value for the other interview without bloating the take-home.

## 2. Expo vs bare React Native (PENDING — decide in mobile phase)
- **Tradeoff**: Expo = faster setup, managed builds, OTA-ready (CodePush/EAS); bare RN = full native control.
- **Working lean**: Expo recommended (speed + OTA story aligns with the CodePush/OTA interview topic).
- **Status**: to be confirmed when the mobile slice starts.
