/**
 * Numeric-Only Field Enforcement
 * -----------------------------------------------------------------------
 * Restricts an input to digits only, live, as the user types (also blocks
 * pasted non-numeric content). Works on ANY page — just add the
 * data-numeric-only attribute to any <input>:
 *
 *   <input type="tel" name="phone_number" data-numeric-only>
 *
 * No per-field JS needed. This auto-discovers every [data-numeric-only]
 * element on the page, wherever this script is included.
 */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-numeric-only]').forEach((input) => {
        input.addEventListener('input', () => {
            const cleaned = input.value.replace(/[^0-9]/g, '');
            if (cleaned !== input.value) {
                input.value = cleaned;
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData).getData('text');
            const cleaned = pasted.replace(/[^0-9]/g, '');
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = input.value.slice(0, start) + cleaned + input.value.slice(end);
            input.dispatchEvent(new Event('input'));
        });
    });
});
