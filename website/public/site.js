// The screenshots' light/dark switch: the section shows the images of the theme in
// its data-theme.
const screenshots = document.querySelector(".screenshots");
const themeSwitch = screenshots?.querySelector(".theme-switch");
if (screenshots && themeSwitch) {
  themeSwitch.hidden = false;
  const choices = themeSwitch.querySelectorAll("button");
  for (const choice of choices) {
    choice.addEventListener("click", () => {
      screenshots.dataset.theme = choice.value;
      for (const other of choices) {
        other.setAttribute("aria-pressed", String(other === choice));
      }
    });
  }
}

const button = document.querySelector("#copy");
const command = document.querySelector("#install-command");
const status = document.querySelector("#copy-status");

if (button && command && status && navigator.clipboard) {
  button.hidden = false;
  let reset;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(command.textContent);
      button.textContent = "Copied!";
      status.textContent = "Install command copied to clipboard.";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(command);
      selection?.removeAllRanges();
      selection?.addRange(range);
      status.textContent = "Select and copy the highlighted command.";
      button.textContent = "Select & copy";
    }
    reset = setTimeout(() => {
      button.textContent = "Copy";
    }, 3000);
  });
}
