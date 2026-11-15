export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  const firstPage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const lastPage = Math.min(totalPages, firstPage + 4);
  return (
    <nav className="pagination" aria-label="Hotel results pages">
      <button className="page-arrow" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">←</button>
      {Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index).map((number) => (
        <button key={number} className={`page-number ${number === page ? "active" : ""}`} onClick={() => onPageChange(number)} aria-current={number === page ? "page" : undefined}>{number}</button>
      ))}
      <button className="page-arrow" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">→</button>
      <span className="pagination-label">Page {page} of {totalPages}</span>
    </nav>
  );
}
