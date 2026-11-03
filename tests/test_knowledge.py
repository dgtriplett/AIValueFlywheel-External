"""Knowledge base: slugs, folder paths, attachment validation, search SQL.

The attachment tests are the security-relevant ones. These bytes are uploaded by one
user and served back to another, so the declared type has to be verified against the
actual content — a file claiming to be a PDF that is really HTML becomes stored XSS
the moment a browser renders it. Each rejection case below is a payload that would
otherwise be stored and served under a type it does not have.
"""
import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import stubs  # noqa: E402,F401

from server import knowledge as kb  # noqa: E402

ROOT = Path(__file__).parent.parent


class TestSlugify(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(kb.slugify("Protection Standards"), "protection-standards")

    def test_strips_punctuation(self):
        self.assertEqual(kb.slugify("SAIDI/SAIFI Definitions!"),
                         "saidisaifi-definitions")

    def test_transliterates_accents(self):
        # Percent-encoding would be unreadable in a URL, an export, and a
        # [[wiki link]] alike.
        self.assertEqual(kb.slugify("Réseau électrique"), "reseau-electrique")

    def test_collapses_whitespace_runs(self):
        self.assertEqual(kb.slugify("A   B \t C"), "a-b-c")

    def test_caps_length(self):
        self.assertLessEqual(len(kb.slugify("word " * 100)), kb.MAX_SLUG_LENGTH)

    def test_never_ends_with_a_separator(self):
        # A trailing dash after truncation looks like a broken link.
        for title in ("word " * 30, "a-" * 60, "Ends With Dash -"):
            self.assertFalse(kb.slugify(title).endswith("-"), title[:20])

    def test_untitleable_input_still_yields_a_slug(self):
        """Punctuation-only or non-Latin titles must not produce an empty slug."""
        for title in ("!!!", "###", "。。。", "   "):
            slug = kb.slugify(title)
            self.assertTrue(slug, f"empty slug for {title!r}")
            self.assertTrue(slug.startswith("article-"), slug)

    def test_fallback_is_stable_for_the_same_title(self):
        # Deterministic, so re-saving does not silently change the URL.
        self.assertEqual(kb.slugify("!!!"), kb.slugify("!!!"))

    def test_reserved_slugs_are_escaped(self):
        """A route literal must not be shadowed by an article slug.

        /kb/articles/search is a real route; an article slugged "search" would be
        unreachable. That exact route-shadowing class of bug has already been fixed
        three times elsewhere in this app.
        """
        for reserved in ("search", "new", "versions", "export"):
            self.assertNotEqual(kb.slugify(reserved), reserved)
            self.assertNotIn(kb.slugify(reserved), kb.RESERVED_SLUGS)

    def test_collision_gets_a_numeric_suffix(self):
        self.assertEqual(
            kb.slugify("Protection Standards", existing={"protection-standards"}),
            "protection-standards-2")

    def test_collision_skips_taken_suffixes(self):
        existing = {"standards", "standards-2", "standards-3"}
        self.assertEqual(kb.slugify("Standards", existing=existing), "standards-4")

    def test_collision_result_respects_the_length_cap(self):
        long_title = "x" * kb.MAX_SLUG_LENGTH
        base = kb.slugify(long_title)
        result = kb.slugify(long_title, existing={base})
        self.assertLessEqual(len(result), kb.MAX_SLUG_LENGTH)
        self.assertNotEqual(result, base)


class TestFolderPaths(unittest.TestCase):
    def test_root_folder(self):
        self.assertEqual(kb.folder_path(None, "Standards & Specs"),
                         "/standards-specs/")

    def test_nested_folder(self):
        self.assertEqual(kb.folder_path("/standards-specs/", "Protection"),
                         "/standards-specs/protection/")

    def test_always_has_both_slashes(self):
        """A trailing slash is what stops a prefix match hitting a sibling.

        Without it, `LIKE '/standards%'` also matches '/standards-2/', so asking for
        one folder's subtree silently returns another folder's articles.
        """
        for path in (kb.folder_path(None, "A"), kb.folder_path("/a/", "B")):
            self.assertTrue(path.startswith("/"))
            self.assertTrue(path.endswith("/"))

    def test_sibling_prefix_does_not_match_subtree(self):
        standards = kb.folder_path(None, "Standards")
        standards_2 = kb.folder_path(None, "Standards 2")
        self.assertFalse(standards_2.startswith(standards),
                         f"{standards_2} would be returned when querying "
                         f"the subtree of {standards}")

    def test_like_metacharacters_are_escaped(self):
        """A folder named "50% load" must not turn % into a wildcard."""
        pattern = kb.descendant_pattern("/50%_load/")
        self.assertIn("\\%", pattern)
        self.assertIn("\\_", pattern)
        self.assertTrue(pattern.endswith("%"), "must still match descendants")

    def test_circular_move_is_detected(self):
        # Moving a folder into its own descendant detaches the whole branch: the
        # sidebar silently stops rendering those articles.
        self.assertTrue(kb.is_circular_move("/a/", "/a/b/"))
        self.assertTrue(kb.is_circular_move("/a/", "/a/"))
        self.assertFalse(kb.is_circular_move("/a/", "/c/"))
        self.assertFalse(kb.is_circular_move("/a/", "/ab/"),
                         "a name prefix is not a descendant")


class TestAttachmentValidation(unittest.TestCase):
    PDF = b"%PDF-1.7\n1 0 obj\n<</Type/Catalog>>"
    ZIP = b"PK\x03\x04\x14\x00\x00\x00"
    DOCX = ("application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document")

    def test_accepts_a_real_pdf(self):
        mime, digest = kb.validate_attachment("study.pdf", "application/pdf", self.PDF)
        self.assertEqual(mime, "application/pdf")
        self.assertEqual(len(digest), 64)

    def test_accepts_office_formats(self):
        for name, mime in (("a.docx", self.DOCX),
                           ("b.xlsx", "application/vnd.openxmlformats-officedocument"
                                      ".spreadsheetml.sheet")):
            resolved, _ = kb.validate_attachment(name, mime, self.ZIP)
            self.assertEqual(resolved, mime)

    def test_rejects_html_disguised_as_pdf(self):
        """The stored-XSS case: served back under a PDF type, rendered as HTML."""
        with self.assertRaises(kb.AttachmentRejected) as caught:
            kb.validate_attachment("evil.pdf", "application/pdf",
                                   b"<html><script>alert(1)</script></html>")
        self.assertIn("does not look like", str(caught.exception))

    def test_rejects_a_zip_renamed_to_pdf(self):
        with self.assertRaises(kb.AttachmentRejected) as caught:
            kb.validate_attachment("renamed.pdf", "application/pdf", self.ZIP)
        self.assertIn("contents look like", str(caught.exception))

    def test_rejects_an_unlisted_type(self):
        for name, mime, content in (
            ("x.exe", "application/x-msdownload", b"MZ\x90\x00"),
            ("x.svg", "image/svg+xml", b"<svg onload=alert(1)>"),
            ("x.html", "text/html", b"<html>"),
        ):
            with self.assertRaises(kb.AttachmentRejected):
                kb.validate_attachment(name, mime, content)

    def test_rejects_a_mismatched_extension(self):
        # Declared type and filename must agree, or the download route's filename
        # and its Content-Type disagree about what the file is.
        with self.assertRaises(kb.AttachmentRejected) as caught:
            kb.validate_attachment("study.docx", "application/pdf", self.PDF)
        self.assertIn("extension", str(caught.exception))

    def test_rejects_empty(self):
        with self.assertRaises(kb.AttachmentRejected):
            kb.validate_attachment("a.pdf", "application/pdf", b"")

    def test_rejects_oversize(self):
        oversize = self.PDF + b"\x00" * kb.MAX_ATTACHMENT_BYTES
        with self.assertRaises(kb.AttachmentRejected) as caught:
            kb.validate_attachment("big.pdf", "application/pdf", oversize)
        self.assertIn("limit", str(caught.exception))

    def test_size_cap_fits_a_real_utility_document(self):
        """15MB interconnection studies are routine; the cap must clear them."""
        self.assertGreaterEqual(kb.MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024)

    def test_text_types_are_accepted_without_sniffing(self):
        # No magic number exists for these. Safe because the download route sends
        # Content-Disposition: attachment, so nothing is rendered inline.
        for name, mime in (("a.txt", "text/plain"), ("b.csv", "text/csv"),
                           ("c.md", "text/markdown")):
            resolved, _ = kb.validate_attachment(name, mime, b"anything at all")
            self.assertEqual(resolved, mime)

    def test_checksum_is_content_addressed(self):
        _, first = kb.validate_attachment("a.pdf", "application/pdf", self.PDF)
        _, same = kb.validate_attachment("b.pdf", "application/pdf", self.PDF)
        _, other = kb.validate_attachment("c.pdf", "application/pdf",
                                          self.PDF + b" more")
        self.assertEqual(first, same, "same bytes must hash the same")
        self.assertNotEqual(first, other)

    def test_mime_parameters_are_stripped(self):
        resolved, _ = kb.validate_attachment("a.pdf", "application/pdf; charset=binary",
                                            self.PDF)
        self.assertEqual(resolved, "application/pdf")


class TestSniffMime(unittest.TestCase):
    def test_recognises_known_headers(self):
        self.assertEqual(kb.sniff_mime(b"%PDF-1.4"), "application/pdf")
        self.assertEqual(kb.sniff_mime(b"\x89PNG\r\n\x1a\n"), "image/png")
        self.assertEqual(kb.sniff_mime(b"\xff\xd8\xff\xe0"), "image/jpeg")
        self.assertEqual(kb.sniff_mime(b"PK\x03\x04"), "application/zip")

    def test_unknown_and_empty(self):
        self.assertIsNone(kb.sniff_mime(b"just some text"))
        self.assertIsNone(kb.sniff_mime(b""))


class TestPathTraversal(unittest.TestCase):
    """The Volume writer takes a filename; it must not be able to escape."""

    def test_strips_directory_components(self):
        self.assertEqual(kb.safe_volume_filename("../../etc/passwd"), "passwd")
        self.assertEqual(kb.safe_volume_filename("C:\\Windows\\evil.pdf"), "evil.pdf")
        self.assertEqual(kb.safe_volume_filename("a/b/c/report.pdf"), "report.pdf")

    def test_result_is_a_single_safe_segment(self):
        for hostile in ("../../etc/passwd", "....//x.pdf", "a/b\\c", "..", ".",
                        "a b;rm -rf /.pdf", "\x00null.pdf"):
            safe = kb.safe_volume_filename(hostile)
            self.assertNotIn("/", safe, hostile)
            self.assertNotIn("\\", safe, hostile)
            self.assertFalse(safe.startswith("."), f"{hostile!r} -> {safe!r}")
            self.assertTrue(safe, hostile)

    def test_keeps_ordinary_names_intact(self):
        self.assertEqual(kb.safe_volume_filename("Protection_Standard-v2.pdf"),
                         "Protection_Standard-v2.pdf")


class TestSearchSql(unittest.TestCase):
    """The statement is assembled from filters, so every branch must bind cleanly."""

    ALL_COMBINATIONS = [
        dict(has_query=q, folder=f, tag=t, status=s, entity=e)
        for q in (True, False) for f in (True, False) for t in (True, False)
        for s in (True, False) for e in (True, False)
    ]

    def test_placeholders_are_contiguous_from_one(self):
        """asyncpg errors if $n has a gap, and every combination is reachable."""
        for kwargs in self.ALL_COMBINATIONS:
            sql = kb.build_search_sql(**kwargs)
            numbers = sorted({int(n) for n in re.findall(r"\$(\d+)", sql)})
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)),
                             f"non-contiguous placeholders for {kwargs}: {numbers}")

    def test_no_literal_interpolation_of_values(self):
        """Every user value must arrive as a bind parameter."""
        for kwargs in self.ALL_COMBINATIONS:
            sql = kb.build_search_sql(**kwargs)
            self.assertNotIn("%s", sql)
            self.assertNotIn(".format(", sql)

    def test_orders_by_rank_only_when_ranking(self):
        with_query = kb.build_search_sql(has_query=True, folder=False, tag=False,
                                         status=False, entity=False)
        self.assertIn("AS rank", with_query)
        self.assertIn("ORDER BY rank DESC", with_query)

        without = kb.build_search_sql(has_query=False, folder=False, tag=False,
                                      status=False, entity=False)
        self.assertNotIn("ORDER BY rank", without,
                         "ordering by a column that is not selected is an error")
        self.assertIn("ORDER BY a.updated_at DESC", without)

    def test_uses_websearch_to_tsquery(self):
        """to_tsquery raises on the syntax people actually type; websearch does not."""
        sql = kb.build_search_sql(has_query=True, folder=False, tag=False,
                                  status=False, entity=False)
        self.assertIn("websearch_to_tsquery", sql)
        self.assertNotRegex(sql, r"[^_]plainto_tsquery")

    def test_hides_archived_unless_asked(self):
        default = kb.build_search_sql(has_query=False, folder=False, tag=False,
                                      status=False, entity=False)
        self.assertIn("a.status <> 'archived'", default)
        explicit = kb.build_search_sql(has_query=False, folder=False, tag=False,
                                       status=True, entity=False)
        self.assertNotIn("<> 'archived'", explicit,
                         "an explicit status filter must be able to reach archived")

    def test_folder_filter_covers_the_subtree(self):
        sql = kb.build_search_sql(has_query=False, folder=True, tag=False,
                                  status=False, entity=False)
        self.assertIn("LIKE", sql, "asking for a folder must include what's beneath it")

    def test_query_matches_title_substrings_too(self):
        # Full-text search cannot do infix matching; a partial equipment code should
        # still find its article.
        sql = kb.build_search_sql(has_query=True, folder=False, tag=False,
                                  status=False, entity=False)
        self.assertIn("ILIKE", sql)


class TestWikiLinks(unittest.TestCase):
    def test_extracts_and_slugifies(self):
        self.assertEqual(
            kb.extract_wiki_links("See [[Protection Standards]] then [[Runbooks]]."),
            ["protection-standards", "runbooks"])

    def test_handles_a_display_alias(self):
        self.assertEqual(kb.extract_wiki_links("[[Protection Standards|the standard]]"),
                         ["protection-standards"])

    def test_ignores_empty_and_unclosed(self):
        self.assertEqual(kb.extract_wiki_links("[[]] and [[ ]] and [[unclosed"), [])

    def test_no_links(self):
        self.assertEqual(kb.extract_wiki_links(""), [])
        self.assertEqual(kb.extract_wiki_links("plain prose"), [])


if __name__ == "__main__":
    unittest.main()
