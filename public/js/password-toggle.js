/**
 * Password Visibility Toggle
 * -----------------------------------------------------------------------
 * Works on ANY page. To wire up a password field, just add:
 *
 *   1. An <input type="password" id="some_id"> field
 *   2. A toggle trigger (button/span) next to it with:
 *        data-password-toggle="some_id"
 *      ...and a Bootstrap Icon <i> element inside it (bi-eye by default)
 *
 * Example:
 *   <div class="input-group">
 *     <input type="password" id="new_password" class="form-control">
 *     <span class="input-group-text" data-password-toggle="new_password" role="button" tabindex="0">
 *       <i class="bi bi-eye text-muted"></i>
 *     </span>
 *   </div>
 *
 * No per-field JS or unique icon IDs needed — this script auto-discovers
 * every [data-password-toggle] element on the page, wherever it's included.
 */
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

        // Keyboard accessibility, since the trigger is often a <span>, not a <button>
        toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleVisibility();
            }
        });
    });
});
