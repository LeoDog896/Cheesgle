function newSearch() {
  window.location.href =
    "../Search/search.html?q=" +
    document.getElementsByClassName("searchbar")[0].value;
}

document
  .getElementsByClassName("searchbar")[0]
  .addEventListener("keyup", function (event) {
    event.preventDefault();
    if (event.keyCode === 13) {
      newSearch();
    }
  });
