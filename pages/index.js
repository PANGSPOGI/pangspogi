export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/tracker.html',
      permanent: false,
    },
  };
}

export default function Home() {
  return null;
}
