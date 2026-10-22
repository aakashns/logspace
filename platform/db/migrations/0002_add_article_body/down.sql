update posts
set details = json_set(details, '$.article.body', article_body)
where article_body is not null;

alter table posts drop column article_body;
