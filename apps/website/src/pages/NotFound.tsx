import { Link } from "../lib/router";

export function NotFound() {
  return (
    <div className="container narrow page">
      <h1>Page not found</h1>
      <p className="lead">This page doesn't exist.</p>
      <Link href="/" className="button">
        Back to home
      </Link>
    </div>
  );
}
