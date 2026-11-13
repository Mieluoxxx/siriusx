try {
  var saved = localStorage.getItem('siriusx.colorScheme')
  if (saved === 'light' || saved === 'dark') {
    var meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) meta.setAttribute('content', saved)
  }
} catch {}
