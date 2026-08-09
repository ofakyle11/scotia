<?php
/**
 * Standard page template.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="st-main">
	<div class="st-container">

		<?php while ( have_posts() ) : ?>
			<?php the_post(); ?>

			<div class="st-page-title">
				<h1><?php the_title(); ?></h1>
			</div>

			<article id="post-<?php the_ID(); ?>" <?php post_class( 'st-post st-entry st-entry-full' ); ?>>
				<?php if ( has_post_thumbnail() ) : ?>
					<?php the_post_thumbnail( 'large' ); ?>
				<?php endif; ?>
				<div class="st-post__content">
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
