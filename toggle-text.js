function toggleText(btnId, textId) {
  const fullText = document.getElementById(textId);
  const btn = document.getElementById(btnId);

  if (fullText.classList.contains('hidden')) {
    fullText.classList.remove('hidden');
    btn.textContent = 'Read less';
  } else {
    fullText.classList.add('hidden');
    btn.textContent = 'Read more';
  }
}