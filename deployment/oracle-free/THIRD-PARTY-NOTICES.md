# Third-party components

`seccomp.json` is copied unchanged from Microsoft Playwright v1.64.1, https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json. Playwright is Copyright Microsoft Corporation and licensed under Apache License 2.0; the upstream license is included in PLAYWRIGHT-LICENSE.txt.

Node, Chromium/Chrome for Testing, Xvfb, Openbox, x11vnc, noVNC and websockify are installed from their official Node/Playwright distribution or signed Debian packages. Their package licenses/copyright notices remain in the container. noVNC is MPL-2.0; inspect the exact installed package notices and versions when distributing an image. No upstream source or license has been stripped or relabelled as the application's proprietary code.
