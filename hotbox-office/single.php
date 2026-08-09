<?php
/**
 * Single post template.
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

			<article id="post-<?php the_ID(); ?>" <?php post_class( 'hb-post hb-entry' ); ?>>
				<div class="hb-post__meta">
					<?php echo esc_html( get_the_date() ); ?>
					<?php if ( get_the_category_list( ', ' ) ) : ?>
						&nbsp;&middot;&nbsp; <?php echo wp_kses_post( get_the_category_list( ', ' ) ); ?>
					<?php endif; ?>
				</div>
				<h1><?php the_title(); ?></h1>

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

			<nav class="hb-pagination" aria-label="<?php esc_attr_e( 'Post navigation', 'hotbox-office' ); ?>">
				<?php previous_post_link( '%link', esc_html__( '← Previous', 'hotbox-office' ) ); ?>
				<?php next_post_link( '%link', esc_html__( 'Next →', 'hotbox-office' ) ); ?>
			</nav>

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
