import { Link } from 'react-router-dom';

/**
 * Hashtag/@mention linkifier for post captions & comments (§13.8). Posts
 * aren't E2E encrypted, so there's no crypto concern here — and no link-
 * safety interstitial either, since §14.7 scopes that to messages only.
 */
const TOKEN_PATTERN = /(#\w+|@\w+)/g;

export function PostText({ text }: { text: string }) {
  const parts = text.split(TOKEN_PATTERN);
  return (
    <span className="break-words whitespace-pre-wrap">
      {parts.map((part, index) => {
        if (part.startsWith('#')) {
          return (
            <Link
              key={index}
              to={`/hashtag/${encodeURIComponent(part.slice(1).toLowerCase())}`}
              className="font-medium text-accent hover:underline"
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('@')) {
          return (
            <Link
              key={index}
              to={`/u/${encodeURIComponent(part.slice(1))}`}
              className="font-medium text-accent hover:underline"
            >
              {part}
            </Link>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}
