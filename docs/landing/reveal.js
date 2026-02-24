;(() => {
	// Reveal sections on scroll with graceful no-JS fallback.
	document.documentElement.classList.remove('no-js')

	const revealItems = Array.from(document.querySelectorAll('.reveal'))
	if (revealItems.length === 0) {
		return
	}

	const showItem = (item) => {
		item.classList.add('is-visible')
	}

	if (!('IntersectionObserver' in window)) {
		revealItems.forEach(showItem)
		return
	}

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					showItem(entry.target)
					observer.unobserve(entry.target)
				}
			})
		},
		{
			threshold: 0.2,
			rootMargin: '0px 0px -5% 0px',
		},
	)

	for (const item of revealItems) observer.observe(item)
})()
