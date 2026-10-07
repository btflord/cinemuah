// The buttons under an open movie cassette. Desktop: stream / download / trailer / details.
// Web: there are no torrents, so the trailer becomes the main action.
import type { YtsMovie } from '@/types';
import { Icon } from './Icon';
import { IS_WEB } from '@/lib/platform';

export function MovieShelfActions({ movie, onStream, onDownload, onTrailer, onDetails }: {
  movie: YtsMovie;
  onStream: (m: YtsMovie) => void;
  onDownload: (m: YtsMovie) => void;
  onTrailer: (m: YtsMovie) => void;
  onDetails: (m: YtsMovie) => void;
}) {
  if (IS_WEB) {
    return (
      <>
        <button className="btn btn-primary" onClick={() => onTrailer(movie)}><Icon name="play" /> Watch trailer</button>
        <button className="btn btn-ghost" onClick={() => onDetails(movie)}><Icon name="info" /> Details</button>
      </>
    );
  }
  return (
    <>
      <button className="btn btn-primary" onClick={() => onStream(movie)}><Icon name="play" /> Stream</button>
      <button className="btn btn-secondary" onClick={() => onDownload(movie)}><Icon name="download" /> Download</button>
      {movie.trailerCode && (
        <button className="btn btn-secondary" onClick={() => onTrailer(movie)}><Icon name="trailer" /> Trailer</button>
      )}
      <button className="btn btn-ghost" onClick={() => onDetails(movie)}><Icon name="info" /> Details</button>
    </>
  );
}
