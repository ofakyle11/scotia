<?php
/**
 * Standard page template.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="hb-main">
	<div class="hb-wrap">

		<?php while ( have_posts() ) : ?>
			<?php the_post(); ?>

			<div class="hb-page-title">
				<h1><?php the_title(); ?></h1>
			</div>

			<article id="post-<?php the_ID(); ?>" <?php post_class( 'hb-post hb-entry hb-entry--full' ); ?>>
				<?php if ( has_post_thumbnail() ) : ?>
					<?php the_post_thumbnail( 'large' ); ?>
				<?php endif; ?>
				<div class="hb-post__content">
					<?php
					the_content();
					wp_link_pages();
					?>
				</div>
			</article>

			<?php
			if ( comments_open() || get_comments_number() ) {
				comments_template();
			}
			?>

		<?php endwhile; ?>

	</div>
</main>

<?php
get_footer();
