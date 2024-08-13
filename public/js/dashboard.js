// scripts.js
function updateDateTime() {
    const now = new Date();
    const dateTimeString = now.toLocaleString();
    document.getElementById('date-time').textContent = dateTimeString;
}
setInterval(updateDateTime, 1000);
updateDateTime();  // Initial call to set the date-time immediately
