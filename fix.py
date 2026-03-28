content = open('/Users/aribenezra/Documents/scout-chat/index.html').read()
content = content.replace(
    'av.className = "avatar"; av.textContent = "S";',
    'av.className = "avatar"; av.innerHTML = \'<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 4h12a1 1 0 011 1v7a1 1 0 01-1 1H7l-4 3V5a1 1 0 011-1z" stroke="#4ECDC4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>\';'
)
open('/Users/aribenezra/Documents/scout-chat/index.html', 'w').write(content)
print("Done:", content.count('av.innerHTML') , "replacement(s)")
