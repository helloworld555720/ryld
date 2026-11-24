import "@videojs/react/video/skin.css";

import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { VideoPlayer, VideoSkin } from "@videojs/react/video";

import type { ProjectMedia } from "@/lib/media";

export interface ProjectVideoPlayerProps {
  media: ProjectMedia;
}

/**
 * The finished project, played with Video.js v10.
 *
 * `src`, `poster` and the tracks are absolute URLs already resolved against
 * `MEDIA_BASE_URL` (`lib/media.ts`) — this component never builds one, so the
 * player and the tests agree on how a key becomes a URL.
 *
 * `HlsJsVideo` is the hls.js-backed media element: the playlist is an HLS
 * manifest, and it uses MSE where the browser has no native HLS. MSE moves the
 * stream into a `blob:` URL and hls.js runs a blob worker, which is why the CSP
 * allows `media-src blob:` and `worker-src blob:` (see `lib/csp.ts`).
 *
 * The tracks are optional because each artefact in `source` is: a result with
 * captions but no chapters still plays. `default` is set on all three, as given:
 * thumbnails and chapters are metadata tracks the skin reads, and captions are
 * on until the viewer turns them off.
 *
 * No `preload` tuning: Video.js defaults to `metadata`, which paints the poster
 * without downloading the manifest's segments.
 *
 * Why there is no `<Suspense>` around the player: it was tried exactly as
 * sketched and streamed the player into a `hidden` div that never completed, so
 * the skin rendered at 0×0 with no React fiber attached — invisible and inert,
 * even though hls.js still requested the manifest. Rendering the player
 * directly server-renders it, hydrates it (controls, cast, captions, fullscreen
 * all present) and leaves no skeleton to flash. It is a client component that
 * renders synchronously, so it has nothing to suspend on.
 */
export function ProjectVideoPlayer({ media }: ProjectVideoPlayerProps) {
  return (
    <VideoPlayer title={media.title} poster={media.poster ?? null}>
      <VideoSkin className="aspect-video w-full">
        <HlsJsVideo src={media.playlist} playsInline crossOrigin="anonymous">
          {media.thumbnails ? (
            <track
              kind="metadata"
              label="thumbnails"
              src={media.thumbnails}
              default
            />
          ) : null}
          {media.captions ? (
            <track
              kind="captions"
              src={media.captions}
              srcLang="en"
              label="English"
              default
            />
          ) : null}
          {media.chapters ? (
            <track
              kind="chapters"
              src={media.chapters}
              srcLang="en"
              default
            />
          ) : null}
        </HlsJsVideo>
      </VideoSkin>
    </VideoPlayer>
  );
}
