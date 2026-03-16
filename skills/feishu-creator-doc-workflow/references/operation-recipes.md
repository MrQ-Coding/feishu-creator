# Operation Recipes

Use this reference when the user is already working with Feishu documents or wiki nodes.

## Resolve The Target

- Existing page: `get_document_info`
- Unknown page: `search_feishu_documents`, `list_feishu_wiki_spaces`, or `get_feishu_wiki_tree`
- New page: `create_document`

## Inspect Before Mutating

- Use `get_document_blocks` when parent block, heading position, or section boundary is unclear.
- Prefer heading-based locate helpers when duplicate headings or nested sections are likely.

## Preferred Edit Primitives

- New structured content: `generate_section_blocks`, `generate_rich_text_blocks`
- Replace a section: `replace_section_blocks`, `replace_section_with_ordered_list`
- Insert before a heading: `insert_before_heading`
- Upsert by heading: `upsert_section`
- Move or copy a section: `move_section`, `copy_section`
- Images: `upload_local_image`
- Diagrams: `render_graphviz_diagram`, `render_plantuml_diagram`, `create_graphviz_diagram_block`, `create_plantuml_diagram_block`
- Tables: `create_table`, `get_table`, `update_table_cell`, `replace_table`

## Verification After Changes

1. Re-read the affected area with `get_document_blocks`.
2. Confirm the new blocks landed under the intended parent or heading.
3. Check for duplicate sections, stray list blocks, or misplaced images.
