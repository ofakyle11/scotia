<?php
/**
 * Single post template.
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

			<article id="post-<?php the_ID(); ?>" <?php post_class( 'st-post st-entry' ); ?>>
				<div class="st-post__meta">
					<?php echo esc_html( get_the_date() ); ?>
					<?php if ( get_the_category_list( ', ' ) ) : ?>
						&nbsp;&middot;&nbsp; <?php echo wp_kses_post( get_the_category_list( ', ' ) ); ?>
					<?php endif; ?>
				</div>
				<h1><?php the_title(); ?></h1>

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

			<nav class="st-pagination" aria-label="<?php esc_attr_e( 'Post navigation', 'scotia-tire' ); ?>">
				<?php previous_post_link( '%link', esc_html__( '← Previous', 'scotia-tire' ) ); ?>
				<?php next_post_link( '%link', esc_html__( 'Next →', 'scotia-tire' ) ); ?>
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
