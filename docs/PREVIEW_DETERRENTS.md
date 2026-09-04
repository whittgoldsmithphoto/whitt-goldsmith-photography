# Customer preview deterrents

Public customer photo covers, thumbnails, sports-search results, and lightbox images prevent the usual
image context menu and drag-to-save gesture. A brief, polite local status explains:
“Protected preview. Original downloads require permission.” Repeated attempts while
that notice is visible do not stack messages. There is no telemetry.

Scoped `user-select: none` and `-webkit-touch-callout: none` may discourage image
selection and long-press save on supporting mobile browsers. These are browser-
dependent conveniences, not guarantees. Pinch zoom and browser-global shortcuts
are untouched. Owner original download controls are unchanged.

This does **not** prevent screenshots, screen recording, developer tools, browser
caches, or downloading a preview through another client. No website can promise
black screenshots for ordinary still images. [Encrypted Media Extensions](https://www.w3.org/TR/encrypted-media/)
concerns protected media playback through HTMLMediaElement, not a still-image
page screenshot switch. No focus/visibility tricks or screenshot detection are used.

Actual original-file protection remains private storage, server authorization,
watermarked derivatives, and permission-checked delivery. The browser receives the
preview pixels, so those pixels remain copyable. Context-menu cancellation is only
a casual-saving deterrent and must never be represented as access control.
