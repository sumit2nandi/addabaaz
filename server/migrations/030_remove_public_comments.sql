-- Public comments are no longer a product feature. Keep this forward migration so
-- existing databases remove the old content and report records without rewriting history.
DROP TABLE IF EXISTS comment_reports;
DROP TABLE IF EXISTS comments;
