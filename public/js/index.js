const selectElement = document.getElementById("row-selection");
const alldropdown = document.querySelectorAll(".d-none");

selectElement.addEventListener("change", () => {
    if (selectElement.value === "3") { // Ensure comparison is against a string
        alldropdown.forEach(function(dropdown) {
            dropdown.classList.remove("d-none");
            dropdown.classList.add("d-block");
        });
    } else {
        alldropdown.forEach(function(dropdown) {
            dropdown.classList.add("d-none");
            dropdown.classList.remove("d-block");
        });
    }
});

