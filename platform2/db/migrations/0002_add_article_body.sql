-- An article's Markdown body gets its own column, so it can be searched and left out of queries
-- that don't need it. Bodies already stored in `details` move into it.
alter table posts add column article_body text;

update posts
set
  article_body = json_extract(details, '$.article.body'),
  details = json_remove(details, '$.article.body')
where json_type(details, '$.article.body') = 'text';
