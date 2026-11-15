/** The doctor's footer lines (`footerNotes`), shared by every layout; English in every language, escaped by `{{this}}`;
 * each line clamps to two rows so a long note can never push the page onto another sheet. */
export const FOOTER_NOTES_HTML = `{{#if footerNotes.length}}<div class="rx-footer-notes" style="margin-top:8px;padding-top:5px;border-top:1px dashed #d9d9d9;text-align:center;font-size:9px;line-height:1.35;color:#666">{{#each footerNotes}}<div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{{this}}</div>{{/each}}</div>{{/if}}`;
