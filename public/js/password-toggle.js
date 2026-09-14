
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
        const targetId = toggle.getAttribute('data-password-toggle');
        const input = document.getElementById(targetId);
        const icon = toggle.querySelector('i');

        if (!input || !icon) {
            console.warn(`password-toggle.js: could not find input or icon for target "${targetId}"`);
            return;
        }

        const toggleVisibility = () => {
            const isPassword = input.getAttribute('type') === 'password';
            input.setAttribute('type', isPassword ? 'text' : 'password');

            icon.classList.toggle('bi-eye');
            icon.classList.toggle('bi-eye-slash');

            toggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        };

        toggle.addEventListener('click', toggleVisibility);


        toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleVisibility();
            }
        });
    });
});
