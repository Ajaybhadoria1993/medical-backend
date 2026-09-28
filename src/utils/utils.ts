export const pagination = <T>(page: T, size: T) => {
  let currentPage = Number(page);
  let currentSize = Number(size);
  currentPage = isNaN(currentPage) || currentPage === 0 ? 1 : currentPage;
  currentSize = isNaN(currentSize) || currentSize === 0 ? 10 : currentSize;
  const offset = (currentPage - 1) * currentSize;
  return {
    limit: currentSize,
    offset,
  };
};
