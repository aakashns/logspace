-- The social preview image became the banner image: shown at the top of the home page, and still
-- the link preview image. Its saved settings move to the new names; its file keeps its name.
update config set key = 'bannerImage' where key = 'socialImage';

update config set key = 'bannerImageAlt' where key = 'socialImageAlt';
