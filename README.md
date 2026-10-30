# Align Workflow Recorder — mobile setup

This is a cloud-hosted browser recorder, with a phone control page and an MCP server for an assistant. It creates a real continuous browser video: actual clicks, typing, scrolling and page updates. It does not turn screenshots into a slideshow or add camera zooms.

**Status:** code package built; seven automated test groups passed. The browser-engine download failed in the build environment, so a real browser recording has NOT been verified here. The Docker build runs `npm run test:browser` and must successfully record a synthetic workflow before deployment can complete. No live hosting URL has been created and no connection to your ChatGPT account has been made.

## Start here on your phone

The easiest next step is to connect the Render integration in ChatGPT, then return to this conversation. That lets the assistant inspect deployment options. A cloud host and a source repository are still required. The source bundle is ready for a repository; it does not include hosting credentials or an invented deployment URL.

You do not need Node, Docker, a terminal, or a computer on your phone. The cloud host runs those parts.

### If deploying manually from your phone

1. Download and extract `Align_Workflow_Recorder.zip` using your phone’s file manager.
2. In GitHub’s website, create a private repository. Upload the files from the extracted folder to the repository root. Keep their original filenames. Do not upload this ZIP as the sole repository file; the cloud host needs the extracted Dockerfile, package files and `.mjs` source files.
3. In Render, create a Blueprint from that repository. It reads `render.yaml`, builds the Docker image, runs the automated tests and creates the web service. The supplied blueprint requests the free plan; verify the plan and any charges displayed by the host before proceeding. Availability and resource limits depend on your account.
4. Once the service deploys, open its assigned HTTPS address in your phone’s browser.
5. In Render’s service environment settings, reveal/copy the generated `RECORDER_PASSWORD`. Use it ONLY on your own recorder’s sign-in page. Do not paste it into this conversation. No OpenAI API key is needed.
6. The control page displays the actual `/mcp` endpoint. That is the address to use when adding the recorder as a custom MCP server.

The application uses Render’s `RENDER_EXTERNAL_URL` automatically. For another cloud host, set `PUBLIC_URL` to its exact HTTPS origin (for example, your host-assigned URL, without `/mcp`).

## Connect the assistant

Use the custom MCP server connection flow available to your ChatGPT account/workspace:

1. Open ChatGPT Plugins → plus → Add custom MCP server, where available.
2. Enter a name such as **Align Workflow Recorder** and the actual endpoint shown on the deployed control page.
3. Choose OAuth. The server supports dynamic client registration and PKCE; client ID/secret are discovered through registration for supporting clients.
4. On the recorder’s consent page, verify the service address and enter your recorder password. This approves the assistant to control and record the single personal browser, inspect its pages and download recordings.
5. Review the tools, finish adding the connection, and start a conversation with it enabled.

Account/workspace policy controls whether custom MCP servers can be added. If the native mobile app does not expose the relevant controls, check the ChatGPT website from your phone’s browser. Installing this source ZIP does not enable tools inside ChatGPT by itself.

Suggested first prompt:

> Use Align Workflow Recorder to start a 1280×720 recording of my authorized demo environment. Inspect the page before each action. Follow one fictional candidate from reviewing a role to sharing work proof, then show the employer’s next step. Keep the browser framing fixed. Stop and return the video. Do not contact or assess real applicants, submit real applications, or enter credentials.

Use a staging/demo workspace for write actions. The default allowlist points to the current Align website; this does NOT authorize modifying real user data there. Sign-in redirects and external assets are blocked until their exact origins are explicitly permitted by the owner. This version rejects typing into password inputs during recording; it does not include a remote login handoff system. For authenticated demonstrations, prepare a suitable demo environment before recording.

## Use the phone control page

- Enter an allowed website address and tap **Start recording**.
- Inspect the browser image and the expandable list of visible page elements.
- Choose **Click** and enter a button name, or **Type** and choose its exact field label. Other actions include select, scroll, navigation and basic keyboard keys.
- Each action updates the page view. The preview image is a still used for control; the output is the continuous browser recording.
- Tap **Stop & save video**, then download the MP4. If conversion fails, the original WebM is preserved instead.

Recordings do not contain microphone/system audio. Narration and captions can be added to the video afterward, as in the existing Align editing workflow.

## Tools

| Tool | Purpose |
| --- | --- |
| `browser_start_video` | Start a real browser recording with a chosen viewport. |
| `browser_action` | Click, type, select, scroll, navigate, press a key or wait. |
| `browser_snapshot` | Inspect the active page outline and PNG. |
| `browser_stop_video` | Close the recording and return the export/link. |
| `browser_recording_status` | Check the active session and last completed recording. |

Target examples: `{"role":"button","name":"Work proof"}`, `{"label":"Role title"}`, `{"text":"View details"}`. Ambiguous targets fail rather than choosing an arbitrary match. Actions may change the website; the assistant still needs the user’s authorization for consequential activity.

## Personal deployment behavior

One user, one active browser, one server instance. This is not a multi-tenant public recording platform.

- OAuth access expires in one hour; refresh tokens rotate and expire after seven days. Restarting the server clears clients, tokens and control-page sessions; reconnect afterward.
- Control-page sign-in lasts eight hours. A control-page sign-out does not revoke a separate OAuth connection; disconnect/revoke the assistant separately when needed.
- Recordings stop after approximately three minutes, allowing an in-flight browser action to finish. Download links expire after ten minutes. Files are removed after about one hour (cleanup runs periodically) or when ephemeral hosting storage is recycled.
- Up to ten recording folders are retained at a time. There is no database or permanent media archive.
- Only configured public HTTPS origins are allowed, including network requests. Browser pop-ups and WebSockets are blocked; service workers and downloads are disabled. Some websites need additional resource origins or capabilities and will not work in this restricted configuration.
- All visible page content is recorded. Use fictional data. Typed text is excluded from the action log, but ordinary visible form text still appears in the video.
- No screen/microphone permissions are needed on your phone because the browser runs in the cloud.

## Configuration

| Variable | Purpose |
| --- | --- |
| `RECORDER_PASSWORD` | Required owner password, at least 16 characters; generate/set it in the host environment. |
| `PUBLIC_URL` | Exact HTTPS origin, required off Render. |
| `RENDER_EXTERNAL_URL` | Host-supplied origin used automatically on Render. |
| `ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins the browser may access. |
| `OUTPUT_DIR` | Ephemeral recording directory. |
| `PORT` | Host-supplied listening port. |

Do not expose the stdio process or an unauthenticated development service publicly. The HTTP version includes password sign-in and OAuth. Keep the instance personal and do not share its owner password.

## Developer commands (run on the host, not on your phone)

- `npm ci`
- `npm test` — auth, MCP and mocked-browser lifecycle tests, plus actual WebM-to-MP4 conversion using synthetic media.
- `npm run setup:browser` — install the matching browser outside the supplied Docker image.
- `npm run test:browser` — actual Chromium test against an isolated local fixture; no real website mutations.
- `npm start` — phone console and authenticated HTTP MCP server.
- `npm run mcp` — local stdio integration for compatible developer clients; outputs recording files locally.

Node.js 22+, the pinned Playwright browser, and FFmpeg are required. The Docker image supplies the browser and FFmpeg. Cloud build/runtime success must still be checked on the selected host.

## Primary references

- Playwright recording: https://playwright.dev/docs/videos
- MCP SDK server/transports: https://ts.sdk.modelcontextprotocol.io/server
- ChatGPT custom server connection: https://developers.openai.com/plugins/deploy/connect-chatgpt
- MCP authorization discovery: https://developers.openai.com/plugins/build/auth
- Render Blueprint fields: https://render.com/docs/blueprint-spec

Dependency versions are pinned in `package-lock.json`. Third-party dependencies retain their respective licenses.
